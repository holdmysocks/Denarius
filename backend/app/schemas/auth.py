import json
import uuid
from typing import Optional

from pydantic import BaseModel, EmailStr, field_validator


class RegisterRequest(BaseModel):
    username: str
    email: EmailStr
    password: str

    @field_validator("username")
    @classmethod
    def username_alphanumeric(cls, v: str) -> str:
        if not v.replace("_", "").replace("-", "").isalnum():
            raise ValueError("Username must be alphanumeric (underscores and hyphens allowed)")
        if len(v) < 3 or len(v) > 50:
            raise ValueError("Username must be 3-50 characters")
        return v

    @field_validator("password")
    @classmethod
    def password_length(cls, v: str) -> str:
        if len(v) < 8:
            raise ValueError("Password must be at least 8 characters")
        return v


class LoginRequest(BaseModel):
    username: str
    password: str


class TokenResponse(BaseModel):
    access_token: str
    refresh_token: str
    token_type: str = "bearer"


class RefreshRequest(BaseModel):
    # Optional: browsers send the token via the HttpOnly refresh cookie instead.
    refresh_token: Optional[str] = None


class UserOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    username: str
    email: str
    role: str
    is_active: bool
    theme_dark: Optional[bool] = None
    dashboard_hidden_accounts: Optional[list[str]] = None

    @field_validator("dashboard_hidden_accounts", mode="before")
    @classmethod
    def parse_hidden_accounts(cls, v):
        if isinstance(v, str):
            return json.loads(v)
        return v


class UserPreferencesUpdate(BaseModel):
    theme_dark: Optional[bool] = None
    dashboard_hidden_accounts: Optional[list[str]] = None
