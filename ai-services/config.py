"""
@module 환경 설정
@description 환경 변수를 로드하고 설정 객체를 제공한다.

+-----------+     +-----------+     +-----------+
|  .env     | --> | pydantic  | --> | settings  |
|  파일     |     | Settings  |     |  객체     |
+-----------+     +-----------+     +-----------+

@dependencies pydantic-settings, python-dotenv
"""

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """애플리케이션 전체 설정을 환경 변수에서 로드한다."""

    # Oracle DB
    oracle_user: str = "video"
    oracle_password: str = ""
    oracle_dsn: str = "192.168.0.120:1521/AI_DB"
    oracle_instant_client_path: str = r"C:\instantclient_23_0"

    # Anthropic
    anthropic_api_key: str = ""

    # Server
    log_level: str = "debug"
    host: str = "0.0.0.0"
    port: int = 8000

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


settings = Settings()
