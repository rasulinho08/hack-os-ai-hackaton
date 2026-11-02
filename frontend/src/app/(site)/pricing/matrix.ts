/**
 * The pricing page's plan order and comparison table, apart from the page so
 * tests can check the table against its words in every language.
 */

import type { PlanId, PricingCopy } from "./copy";

export const TIER_IDS: PlanId[] = ["starter", "professional", "business", "enterprise"];
export const FEATURED: PlanId = "professional";

/*
 * The comparison table. Values are in plan order (Starter, Professional,
 * Business, Enterprise) and follow the plan/module split the API enforces
 * (its src/constants/modules.js); "events" and "seats" are filled in from
 * ../_plans.ts. The words live in ./copy.ts under the same keys.
 */
export type Val = boolean | "events" | "seats";
export type MatrixGroup = keyof PricingCopy["matrix"];
const ALL: Val[] = [true, true, true, true];
export const MATRIX: { group: MatrixGroup; rows: { key: string; values: Val[] }[] }[] = [
  {
    group: "event",
    rows: [
      { key: "registration", values: ALL },
      { key: "codes", values: ALL },
      { key: "teams", values: ALL },
      { key: "submissions", values: ALL },
      { key: "late", values: ALL },
      { key: "mentors", values: [false, true, true, true] },
      { key: "volunteers", values: [false, true, true, true] },
      { key: "forms", values: [false, true, true, true] },
      { key: "announcements", values: ALL },
      { key: "automations", values: [false, true, true, true] },
    ],
  },
  {
    group: "judging",
    rows: [
      { key: "weighted", values: ALL },
      { key: "normalisation", values: ALL },
      { key: "leaderboard", values: ALL },
      // Results (with the per-judge, per-criterion view) are in every plan.
      { key: "breakdown", values: ALL },
      { key: "stage", values: [false, true, true, true] },
      // Certificates are in every plan since October 2026.
      { key: "certificates", values: ALL },
      // The post-event report (PDF) for sponsors: module "reports".
      { key: "report", values: [false, true, true, true] },
    ],
  },
  {
    group: "workspace",
    rows: [
      { key: "events", values: ["events", "events", "events", "events"] },
      { key: "seats", values: ["seats", "seats", "seats", "seats"] },
      { key: "archive", values: ALL },
      // Owner, admin, organiser and observer roles exist in every organisation.
      { key: "roles", values: ALL },
    ],
  },
  {
    group: "platform",
    rows: [
      { key: "languages", values: ALL },
      { key: "csv", values: ALL },
      { key: "telegram", values: ALL },
      { key: "chat", values: [false, false, true, true] },
      // Branding and advanced analytics from Professional; webhooks from Business.
      { key: "branding", values: [false, true, true, true] },
      { key: "analytics", values: [false, true, true, true] },
      { key: "calendar", values: [false, false, true, true] },
      { key: "webhooks", values: [false, false, true, true] },
      { key: "domain", values: [false, false, false, true] },
      { key: "cloud", values: [false, false, false, true] },
    ],
  },
  {
    group: "support",
    rows: [
      { key: "email", values: ALL },
      { key: "onboarding", values: [false, true, true, true] },
      { key: "priority", values: [false, false, true, true] },
      { key: "named", values: [false, false, true, true] },
      { key: "sla", values: [false, false, false, true] },
    ],
  },
];
