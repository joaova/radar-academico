class ApplicationError(Exception):
    """Erro esperado de domínio/aplicação, traduzido pela camada HTTP."""

    def __init__(self, status: int, code: str, message: str):
        super().__init__(message)
        self.status = status
        self.code = code
        self.message = message

