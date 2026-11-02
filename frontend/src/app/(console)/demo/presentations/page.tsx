/*
 * The walkthrough's presentations screen is the organiser presentations screen.
 *
 * Re-exported rather than reimplemented: a copy would drift from the
 * product the moment either side changed, and the whole point of this
 * route is that a visitor sees what a customer gets. The sample data
 * comes from the layout, which points the API client at it.
 */
export { default } from "@/app/(dashboard)/presentations/page";
