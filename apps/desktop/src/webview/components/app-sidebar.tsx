import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Map, Plus, Settings } from "lucide-react";
import { useState } from "react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { trpc } from "../api";
import { timeAgo, tripStatus } from "../trip-stats";

export function AppSidebar({ activeTripId }: { activeTripId: string }) {
  const navigate = useNavigate();
  const [search, setSearch] = useState("");
  const { data: trips = [] } = useQuery(trpc.trips.list.queryOptions());
  const shown = trips.filter((t) =>
    t.name.toLowerCase().includes(search.toLowerCase()),
  );
  return (
    <Sidebar>
      <SidebarHeader className="gap-3">
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="caps"
              onClick={() => navigate({ to: "/" })}
            >
              <Map /> Home
            </SidebarMenuButton>
          </SidebarMenuItem>
          <SidebarMenuItem>
            <SidebarMenuButton
              className="caps"
              onClick={() => navigate({ to: "/" })}
            >
              <Plus /> New chat
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
        <SidebarInput
          placeholder="Search…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel className="caps">Trips</SidebarGroupLabel>
          <SidebarMenu>
            {shown.map((t) => (
              <SidebarMenuItem key={t.tripId}>
                <SidebarMenuButton
                  render={
                    <Link to="/trips/$tripId" params={{ tripId: t.tripId }} />
                  }
                  isActive={t.tripId === activeTripId}
                  className="h-auto py-2"
                >
                  <div className="min-w-0">
                    <div className="truncate">{t.name}</div>
                    <div className="caps text-muted-foreground truncate">
                      {tripStatus(t)} · {timeAgo(t.updatedAt)}
                    </div>
                  </div>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenuButton className="caps">
          <Settings /> Settings
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
