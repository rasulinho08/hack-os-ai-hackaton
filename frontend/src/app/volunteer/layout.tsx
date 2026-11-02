import VolunteerShell from "./VolunteerShell";

export const metadata = {
  title: "Volunteer Dashboard",
};

export default function VolunteerLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <VolunteerShell>{children}</VolunteerShell>;
}
