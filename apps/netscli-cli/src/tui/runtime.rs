mod input;
mod tasks;
mod terminal;

use super::state::TuiApp;
use crate::commands;
use anyhow::Result;
use crossterm::event::{self, Event};
use netscli_core::Database;
use std::{sync::Arc, time::Duration};
use tasks::TaskRuntime;

pub async fn run_tui(concurrency: Option<usize>) -> Result<()> {
    let db = commands::try_init_db().await.map(Arc::new);
    let (_cleanup, mut terminal) = terminal::setup()?;

    let mut app = TuiApp::new();
    app.settings = crate::tui_settings::load_settings();
    if let Some(concurrency) = concurrency {
        app.concurrency_override = Some(crate::tui_settings::clamp_max_concurrent_probes(
            concurrency,
        ));
    }
    app.apply_settings();
    let mut tasks = TaskRuntime::new();
    let mut input = input::InputRuntime::new();
    let tick_rate = Duration::from_millis(100);

    loop {
        input.refresh_exit_confirmation(&mut app);
        tasks.refresh_running_detail(&mut app);

        // Sample traffic here rather than from the draw path: `get_stats`
        // holds a mutex across a syscall, and drawing is synchronous so it
        // cannot yield (B-10). `block_in_place` keeps the borrow.
        tokio::task::block_in_place(|| app.refresh_traffic_stats());

        app.draw(&mut terminal)?;
        if app.running {
            app.suggestions.clear();
        } else {
            app.update_suggestions();
        }

        tasks.finish_ready_task(&mut app).await;

        // `event::poll` parks the calling thread for up to `tick_rate`, and
        // this loop runs on a tokio worker — so every iteration blocked a
        // worker for 100ms whether or not a key arrived (B-10). Both the poll
        // and the read move to a blocking thread; they stay together so the
        // read cannot race another poller.
        let polled = tokio::task::spawn_blocking(move || -> std::io::Result<Option<Event>> {
            if event::poll(tick_rate)? {
                Ok(Some(event::read()?))
            } else {
                Ok(None)
            }
        })
        .await
        .map_err(|e| std::io::Error::other(e.to_string()))??;

        let Some(Event::Key(key)) = polled else {
            continue;
        };

        if input.handle_key(key, &mut app, &mut tasks, &db).await? {
            break;
        }
    }

    Ok(())
}

type SharedDb = Option<Arc<Database>>;
