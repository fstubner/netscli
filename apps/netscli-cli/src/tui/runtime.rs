mod input;
mod tasks;
mod terminal;

use super::state::TuiApp;
use crate::commands;
use anyhow::Result;
use crossterm::event::{self, Event};
use netscli_core::{Database, Ops, OpsConfig};
use std::{sync::Arc, time::Duration};
use tasks::TaskRuntime;

pub async fn run_tui(concurrency: usize) -> Result<()> {
    let db = commands::try_init_db().await.map(Arc::new);
    let (_cleanup, mut terminal) = terminal::setup()?;

    let mut app = TuiApp::new();
    app.settings = crate::tui_settings::load_settings();
    app.apply_settings();

    let ops = Ops::new(OpsConfig {
        concurrency,
        ..Default::default()
    });
    let mut tasks = TaskRuntime::new();
    let mut input = input::InputRuntime::new();
    let tick_rate = Duration::from_millis(100);

    loop {
        input.refresh_exit_confirmation(&mut app);
        tasks.refresh_running_detail(&mut app);

        app.draw(&mut terminal)?;
        if app.running {
            app.suggestions.clear();
        } else {
            app.update_suggestions();
        }

        tasks.finish_ready_task(&mut app).await;

        if event::poll(tick_rate)? {
            match event::read()? {
                Event::Resize(_, _) => {}
                Event::Mouse(_) => {}
                Event::Key(key) => {
                    if input
                        .handle_key(key, &mut app, &mut tasks, &ops, &db)
                        .await?
                    {
                        break;
                    }
                }
                _ => {}
            }
        }
    }

    Ok(())
}

type SharedDb = Option<Arc<Database>>;
