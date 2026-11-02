/*
 * The walkthrough's leaderboard screen is the organiser leaderboard screen.
 *
 * Re-exported rather than reimplemented: a copy would drift from the
 * product the moment either side changed, and the whole point of this
 * route is that a visitor sees what a customer gets. The sample data
 * comes from the layout, which points the API client at it.
 */
export { default } from "@/app/(dashboard)/leaderboard/page";
