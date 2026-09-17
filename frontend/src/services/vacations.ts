import { makeCrudService } from "./crud";
import type { Vacation } from "./types";

export const vacationsService = makeCrudService<Vacation>("vacations");
