"""Interface e API na mesma origem para publicação com um único servidor."""

from pathlib import Path
import re

from fastapi import HTTPException
from fastapi.responses import FileResponse, Response

from .config import Settings
from .main import create_app

FRONTEND = Path(__file__).resolve().parents[2] / "frontend"


def create_web_app(settings: Settings | None = None):
    application = create_app(settings)

    @application.api_route("/config.js", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend_config():
        return Response(
            "export const API_URL = window.location.origin;\n",
            media_type="text/javascript",
            headers={"Cache-Control": "no-store"},
        )

    @application.api_route("/", methods=["GET", "HEAD"], include_in_schema=False)
    def index():
        return FileResponse(FRONTEND / "index.html", headers={"Cache-Control": "no-store"})

    @application.api_route("/{filename}", methods=["GET", "HEAD"], include_in_schema=False)
    def frontend_file(filename: str):
        # A mesma lista de formatos do servidor local; não expor testes ou configuração.
        if not re.fullmatch(r"[a-z0-9-]+\.(?:html|css|js)", filename):
            raise HTTPException(status_code=404)
        path = FRONTEND / filename
        if not path.is_file():
            raise HTTPException(status_code=404)
        return FileResponse(path, headers={"Cache-Control": "no-store"})

    return application


app = create_web_app()
