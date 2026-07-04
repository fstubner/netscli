use super::super::{events, state::TuiApp};
use super::SharedDb;
use crate::tui_formatter::Formatter;
use netscli_core::{Ops, OpsConfig, PcapCancelToken};
use ratatui::text::Line;
use tokio::sync::watch;

pub(super) struct TaskRuntime {
    task: Option<tokio::task::JoinHandle<Vec<Line<'static>>>>,
    pcap_cancel: Option<PcapCancelToken>,
    progress_rx: Option<watch::Receiver<String>>,
}

impl TaskRuntime {
    pub(super) fn new() -> Self {
        Self {
            task: None,
            pcap_cancel: None,
            progress_rx: None,
        }
    }

    pub(super) fn refresh_running_detail(&mut self, app: &mut TuiApp<'_>) {
        if app.running {
            app.running_detail = self.progress_rx.as_ref().and_then(|rx| {
                let msg = rx.borrow().clone();
                (!msg.trim().is_empty()).then_some(msg)
            });
        } else {
            app.running_detail = None;
            self.progress_rx = None;
        }
    }

    pub(super) async fn finish_ready_task(&mut self, app: &mut TuiApp<'_>) {
        let Some(handle) = self.task.as_mut() else {
            return;
        };
        if !handle.is_finished() {
            return;
        }

        let handle = self.task.take().expect("task just checked as Some");
        match handle.await {
            Ok(lines) => app.finish_current(lines),
            Err(e) if e.is_cancelled() => {
                app.finish_current(vec![Formatter::format_notice("Operation cancelled")]);
            }
            Err(e) => app.finish_current(vec![Formatter::format_error(&format!(
                "Operation failed: {e}"
            ))]),
        }
        app.running = false;
        app.set_status("ready");
        self.clear();
    }

    pub(super) async fn cancel_running(&mut self, app: &mut TuiApp<'_>) {
        if let Some(cancel_token) = self.pcap_cancel.take() {
            cancel_token.cancel();
            if let Some(handle) = self.task.take() {
                match handle.await {
                    Ok(lines) => app.finish_current(lines),
                    Err(e) => app.finish_current(vec![Formatter::format_error(&format!(
                        "Operation failed: {e}"
                    ))]),
                }
            }
            app.running = false;
            app.set_status("ready");
            self.progress_rx = None;
            return;
        }

        if let Some(handle) = self.task.take() {
            handle.abort();
            let _ = handle.await;
            app.running = false;
            app.set_status("cancelled");
            app.finish_current(vec![Formatter::format_notice("Operation cancelled")]);
            self.progress_rx = None;
        }
    }

    pub(super) fn spawn_command(
        &mut self,
        input: String,
        first: &str,
        max_concurrent_probes: usize,
        db: &SharedDb,
    ) {
        let ops = Ops::new(OpsConfig {
            concurrency: max_concurrent_probes,
            ..Default::default()
        });
        let db = db.clone();
        let (progress_tx, rx) = watch::channel(String::new());
        self.progress_rx = Some(rx);

        let pcap_cancel_for_task = if first == "/pcap" {
            let token = PcapCancelToken::new();
            self.pcap_cancel = Some(token.clone());
            Some(token)
        } else {
            self.pcap_cancel = None;
            None
        };

        self.task = Some(tokio::spawn(async move {
            events::handle_command(
                input,
                &ops,
                db.as_deref(),
                pcap_cancel_for_task,
                Some(progress_tx),
            )
            .await
        }));
    }

    fn clear(&mut self) {
        self.pcap_cancel = None;
        self.progress_rx = None;
    }
}
