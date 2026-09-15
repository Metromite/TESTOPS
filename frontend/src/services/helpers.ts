import { makeCrudService } from "./crud";
import type { Helper } from "./types";

export const helpersService = makeCrudService<Helper>("helpers");
