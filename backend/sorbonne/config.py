from pydantic_settings import BaseSettings, SettingsConfigDict


class Config(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", env_file_encoding="utf-8", extra="ignore")

    cors_origins: list[str] = [
        "http://localhost:3000",
        "http://127.0.0.1:3000",
        "http://localhost:3001",
        "http://127.0.0.1:3001",
    ]
    database_url: str = "postgresql+psycopg://sorbonne:sorbonne@localhost:5433/sorbonne"
    google_books_api_key: str | None = None
    google_documents_oauth_client_id: str | None = None
    google_documents_service_account_json: str | None = None
    google_documents_response_sheet_id: str | None = None
    google_documents_response_sheet_range: str = "Form Responses 1!A:ZZ"
    google_documents_response_email_header: str = "Email address"
    google_documents_response_timestamp_header: str = "Timestamp"
    google_documents_drive_root_folder_id: str | None = None
    google_documents_access_emails: str = ""
    google_documents_max_zip_bytes: int = 104_857_600
    # Staff sign-in. Without all three the application closes rather than opening:
    # see sorbonne/services/auth_gate.py.
    google_auth_client_id: str | None = None
    coordinator_access_emails: str = ""
    session_secret: str | None = None
    session_hours: int = 12
    # SCEN Student Hub (separate deployment) — the timetable uploader is
    # disabled until both of these are configured.
    scen_student_platform_url: str | None = None
    scen_student_platform_token: str | None = None


config = Config()
