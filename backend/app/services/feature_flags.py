"""
services/feature_flags.py
----------------------------
Direct port of feature_flags.py's is_enabled()/all_flags() behavior -
unknown flag name returns False (fail closed), never raises. Storage is
now the FeatureFlag Postgres table instead of a YAML file.
"""
from sqlalchemy.orm import Session

from app.models.feature_flags import FeatureFlag


def is_enabled(db: Session, name: str) -> bool:
    flag = db.query(FeatureFlag).filter(FeatureFlag.name == name).first()
    return bool(flag.enabled) if flag else False  # unknown flag -> OFF, not an error


def all_flags(db: Session) -> list[dict]:
    return [
        {"name": f.name, "enabled": f.enabled, "description": f.description}
        for f in db.query(FeatureFlag).order_by(FeatureFlag.name).all()
    ]


def set_flag(db: Session, name: str, enabled: bool, description: str = "", updated_by: str = ""):
    flag = db.query(FeatureFlag).filter(FeatureFlag.name == name).first()
    if flag:
        flag.enabled = enabled
        if description:
            flag.description = description
        flag.updated_by = updated_by
    else:
        db.add(FeatureFlag(name=name, enabled=enabled, description=description, updated_by=updated_by))
    db.commit()
