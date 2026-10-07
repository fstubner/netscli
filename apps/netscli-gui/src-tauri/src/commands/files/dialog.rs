use tokio::sync::oneshot;

/// Show a native file dialog from an `async` command and wait for its answer.
///
/// `show` is one of the dialog plugin's callback calls (`pick_file`,
/// `pick_folder`, `save_file`). It puts the dialog on the main thread and
/// reports from a thread of its own, so nothing here blocks the main thread,
/// and nothing blocks a runtime worker either while the user decides.
///
/// This is why the commands that open a dialog are `async`. A plain `fn`
/// command runs on the main thread, and the plugin says its `blocking_*` calls
/// "should *NOT* be used when running on the main thread". The window stops
/// repainting for as long as the dialog is open, and on macOS the dialog is
/// driven by the main run loop, which a main thread waiting on the dialog
/// cannot also run.
///
/// `None` is a cancelled dialog, or an app that began closing before the dialog
/// was answered.
pub(super) async fn ask<T: Send + 'static>(
    show: impl FnOnce(Box<dyn FnOnce(Option<T>) + Send>),
) -> Option<T> {
    let (answer, answered) = oneshot::channel();
    show(Box::new(move |chosen| {
        let _ = answer.send(chosen);
    }));
    answered.await.ok().flatten()
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::atomic::{AtomicUsize, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    /// The wait must leave the thread it runs on free.
    ///
    /// The plugin's own `blocking_*` calls park the calling thread on a channel,
    /// which is what froze the window when these commands were plain `fn`s. A
    /// current-thread runtime makes the difference visible: a second task has
    /// to get time while `ask` waits for a dialog answered from another thread,
    /// the way the plugin answers.
    #[tokio::test(flavor = "current_thread")]
    async fn waiting_for_a_dialog_leaves_the_thread_free() {
        let ticks = Arc::new(AtomicUsize::new(0));
        let counter = Arc::clone(&ticks);
        tokio::spawn(async move {
            loop {
                counter.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(2)).await;
            }
        });

        let chosen = ask(|done| {
            std::thread::spawn(move || {
                std::thread::sleep(Duration::from_millis(100));
                done(Some("report.json"));
            });
        })
        .await;

        assert_eq!(chosen, Some("report.json"));
        assert!(
            ticks.load(Ordering::SeqCst) > 1,
            "nothing else ran while the dialog was open"
        );
    }

    #[tokio::test]
    async fn a_dialog_that_is_never_answered_reads_as_cancelled() {
        // The app closing with a dialog open drops the callback unanswered.
        // The plugin's blocking calls unwrap that and panic.
        let chosen: Option<String> = ask(drop).await;
        assert_eq!(chosen, None);
    }
}
