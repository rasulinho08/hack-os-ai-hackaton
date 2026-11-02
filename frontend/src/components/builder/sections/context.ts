import type { BuilderApi } from "@/lib/builder/useBuilder";
import type { BuilderEvent, BuilderPayload, Catalog } from "@/lib/builder/types";

/** What every section receives. */
export interface SectionCtx {
  b: BuilderApi;
  data: BuilderPayload;
  ev: BuilderEvent;
  catalog: Catalog | null;
  t: (k: string) => string;
  lang: string;
  set: (fields: Record<string, unknown>) => void;
  err: (field: string) => string | null;
  zone: string;
  zoneLabel: string;
  has: (module: string) => boolean;
  /** Replace {name} placeholders in a translated string. */
  f: (key: string, params: Record<string, string | number>) => string;
}
