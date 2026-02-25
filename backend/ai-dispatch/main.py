from fastapi import FastAPI
from pydantic import BaseModel
import numpy as np, redis, os, json
from dotenv import load_dotenv
load_dotenv()

app   = FastAPI()
r     = redis.from_url(os.getenv("REDIS_URL", "redis://localhost:6379"))

class DispatchRequest(BaseModel):
    parcelId:    str
    pickupLat:   float
    pickupLng:   float
    destRegion:  str
    weightKg:    float

@app.post("/assign")
async def assign(req: DispatchRequest):
    # Get all online riders from Redis
    rider_ids = r.smembers("riders:online")
    if not rider_ids:
        return {"riderId": None, "reason": "no_riders_online"}

    riders, pickup = [], (req.pickupLat, req.pickupLng)
    for rid in rider_ids:
        raw = r.get(f"rider:data:{rid.decode()}")
        if raw: riders.append(json.loads(raw))

    if not riders:
        return {"riderId": None, "reason": "no_rider_data_found"}

    scored = sorted(
        [(rd["id"], score(rd, pickup, req)) for rd in riders],
        key=lambda x: x[1], reverse=True
    )

    best = scored[0][0]
    locked = r.set(f"rider:lock:{best}", req.parcelId, nx=True, ex=300)
    if not locked and len(scored) > 1:
        best = scored[1][0]

    return {"riderId": best, "score": round(scored[0][1], 3)}


def score(rider, pickup, req) -> float:
    dist = haversine(pickup, (rider["lat"], rider["lng"]))
    return (
        max(0, 1-dist/20)              * 0.35 +
        max(0, 1-rider["tasks"]/5)     * 0.20 +
        rider["rating"]/5.0            * 0.15 +
        rider["successRate"]           * 0.15 +
        (1.0 if rider["vehicle"]!="bicycle" or req.weightKg<5 else 0.4) * 0.10 +
        rider.get("territories",{}).get(req.destRegion, 0.5) * 0.05
    )

def haversine(a, b) -> float:
    R = 6371
    la1,lo1 = np.radians(a); la2,lo2 = np.radians(b)
    return R * 2 * np.arcsin(np.sqrt(
        np.sin((la2-la1)/2)**2 +
        np.cos(la1)*np.cos(la2)*np.sin((lo2-lo1)/2)**2))

@app.get("/health")
def health(): return {"status": "ok"}
