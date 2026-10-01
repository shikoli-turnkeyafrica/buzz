import { ListChecks } from "lucide-react";

import { useAppNavigation } from "@/app/navigation/useAppNavigation";
import { useCommunities } from "@/features/communities/useCommunities";
import {
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/shared/ui/sidebar";
import { SidebarMenuLabel } from "@/shared/ui/sidebar-menu-label";
import { taskCount } from "../myTasks";
import { useMyTasks } from "../useMyTasks";

/** "My tasks" in the sidebar, with how many things wait on me. */
export function MyTasksMenuItem({ isActive }: { isActive: boolean }) {
  const { activeCommunity } = useCommunities();
  const { goTasks } = useAppNavigation();
  const tasksQuery = useMyTasks();
  if (!activeCommunity?.cybercare) return null;
  const count = taskCount(tasksQuery.data ?? []);
  return (
    <SidebarMenuItem>
      <SidebarMenuButton
        className="data-[active=true]:font-normal"
        data-testid="open-my-tasks"
        isActive={isActive}
        onClick={() => void goTasks()}
        tooltip="My tasks"
        type="button"
      >
        <ListChecks className="h-4 w-4" />
        <SidebarMenuLabel>My tasks</SidebarMenuLabel>
      </SidebarMenuButton>
      {count > 0 ? (
        <SidebarMenuBadge
          className="right-2 rounded-full bg-primary/15 px-1.5 text-2xs text-primary peer-data-[active=true]/menu-button:bg-sidebar-active-foreground/20 peer-data-[active=true]/menu-button:text-sidebar-active-foreground"
          data-testid="sidebar-my-tasks-count"
        >
          {Math.min(count, 99)}
        </SidebarMenuBadge>
      ) : null}
    </SidebarMenuItem>
  );
}
