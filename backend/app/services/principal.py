from dataclasses import dataclass

from ..models import ApiKey, User


@dataclass
class Principal:
    """Ai đang gọi: người dùng trên web, hoặc một key API (n8n, Claude Code...)."""

    user: User
    api_key: ApiKey | None = None

    @property
    def branch_id(self) -> int | None:
        return self.user.branch_id

    @property
    def is_admin(self) -> bool:
        return self.user.role == "admin"

    @property
    def is_manager(self) -> bool:
        return self.user.role in ("admin", "manager")
