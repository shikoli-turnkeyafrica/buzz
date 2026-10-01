import * as React from "react";
import { createFileRoute } from "@tanstack/react-router";

import { ViewLoadingFallback } from "@/shared/ui/ViewLoadingFallback";

const MyTasksScreen = React.lazy(async () => {
  const module = await import("@/features/cybercare/ui/MyTasksScreen");
  return { default: module.MyTasksScreen };
});

export const Route = createFileRoute("/tasks")({
  component: TasksRouteComponent,
});

function TasksRouteComponent() {
  return (
    <React.Suspense
      fallback={<ViewLoadingFallback includeHeader kind="pulse" />}
    >
      <MyTasksScreen />
    </React.Suspense>
  );
}
