/*
 * The walkthrough's invitations screen is the organiser invitations screen.
 *
 * Re-exported rather than reimplemented, like the other walkthrough pages:
 * the layout points the API client at the sample data, and sending is
 * refused there as every other write is.
 */
export { default } from "@/app/(dashboard)/invitations/page";
