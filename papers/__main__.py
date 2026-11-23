import sys

from papers.cli import main

if sys.stdout is not None:
    main()
else:
    # Started without a console (the desktop icon on Windows): a crash would leave no trace, so it's written next to
    # Papers' settings (last-error.txt), where it can be found and shown.
    try:
        main()
    except SystemExit:
        raise
    except BaseException:
        import traceback

        from papers import config
        try:
            config.config_file().parent.mkdir(parents=True, exist_ok=True)
            (config.config_file().parent / "last-error.txt").write_text(traceback.format_exc(), encoding="utf-8")
        except OSError:
            pass
        raise
