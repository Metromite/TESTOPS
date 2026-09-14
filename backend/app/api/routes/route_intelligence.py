from fastapi import APIRouter, Depends
from sqlalchemy.orm import Session

from app.core.database import get_db
from app.core.security import get_current_user
from app.services import route_reconstruction as rr

router = APIRouter(prefix="/api/route-intelligence", tags=["route-intelligence"])


@router.get("/driver-dates", dependencies=[Depends(get_current_user)])
def driver_dates(db: Session = Depends(get_db)):
    """Lets the frontend offer a picker of real driver+date combinations
    that actually have imported data, instead of requiring the user to
    already know one to try reconstruction."""
    rows = rr.get_distinct_driver_dates(db)
    return [{"driver_name": d, "date": dt} for d, dt in rows]


@router.get("/reconstruct", dependencies=[Depends(get_current_user)])
def reconstruct(driver_name: str, date: str, vehicle_key: str = "", db: Session = Depends(get_db)):
    """
    Runs Pass 1 + Pass 2 exactly as ported from V1 - no learning, no
    optimization, matching V1's own explicit scope limit for this module.
    Returns the raw SAP route and the raw Landmark route for the same
    driver-day, side by side, for a person to visually compare.
    """
    sap_route = rr.build_sap_route(db, driver_name, date)
    landmark_route = rr.build_landmark_route(db, driver_name, date, vehicle_key)

    return {
        "sap_route": {
            "driver_name": sap_route.driver_name, "date": sap_route.date,
            "stops_missing_time": sap_route.stops_missing_time,
            "stops": [
                {
                    "invoice_no": s.invoice_no, "customer_name": s.customer_name,
                    "customer_name_source": s.customer_name_source, "box_entry_time": s.box_entry_time,
                    "sequence_position": s.sequence_position, "boxes": s.boxes,
                    "vehicle_key": s.vehicle_key, "area": s.area,
                }
                for s in sap_route.stops
            ],
        },
        "landmark_route": {
            "driver_name": landmark_route.driver_name, "date": landmark_route.date,
            "all_stops_count": len(landmark_route.all_stops),
            "delivery_stops": [
                {
                    "customer_name": s.customer_name, "vehicle_key": s.vehicle_key,
                    "arrival": s.arrival, "departure": s.departure,
                    "duration_minutes": s.duration_minutes, "sequence_position": s.sequence_position,
                }
                for s in landmark_route.delivery_stops
            ],
        },
    }
