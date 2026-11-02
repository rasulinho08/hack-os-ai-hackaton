import { ProjectsClosed } from "@/components/projects/ProjectsClosed";

/* No open projects page at this address: say so, and lead back to the event's page. */
export default function ProjectsNotFound() {
  return <ProjectsClosed />;
}
