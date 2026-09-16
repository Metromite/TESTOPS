DispatchOPS - Supabase database initialization

The EXE connects to the configured Supabase project using the publishable key.
The publishable key is intentionally NOT capable of creating database tables.
Therefore the database schema must be installed once in the Supabase project.

Run SUPABASE_DATABASE_SETUP.bat. It copies the complete migration to the
clipboard and opens the SQL Editor for the configured DispatchOPS project.
Paste and run the migration once. Then rebuild/run DispatchOPS.

The EXE itself contains no local Python/FastAPI/SQLite database.
