import uuid
from typing import Optional
from pydantic import BaseModel, model_validator
from app.models.category import CategoryType


class CategoryCreate(BaseModel):
    name: str
    type: CategoryType
    color: str = "#6B7280"
    icon: Optional[str] = None
    sort_order: int = 0
    once_per_month: bool = False


class CategoryUpdate(BaseModel):
    name: Optional[str] = None
    type: Optional[CategoryType] = None
    color: Optional[str] = None
    icon: Optional[str] = None
    sort_order: Optional[int] = None
    once_per_month: Optional[bool] = None

    @model_validator(mode="after")
    def reject_null_for_required_category_fields(self):
        """Keep explicit null available only for the nullable icon column."""
        required_fields = ("name", "type", "color", "sort_order", "once_per_month")
        for field_name in required_fields:
            if field_name in self.model_fields_set and getattr(self, field_name) is None:
                raise ValueError(f"{field_name} cannot be null")
        return self


class CategoryOut(BaseModel):
    model_config = {"from_attributes": True}

    id: uuid.UUID
    name: str
    type: CategoryType
    color: str
    icon: Optional[str]
    is_system: bool
    sort_order: int
    once_per_month: bool
