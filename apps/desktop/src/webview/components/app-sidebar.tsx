import { useQuery } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { Plus, Settings } from "lucide-react";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import { api } from "../api";

export function AppSidebar({ activeTripId }: { activeTripId: string }) {
  const navigate = useNavigate();
  const { data: trips = [] } = useQuery({
    queryKey: ["trips"],
    queryFn: api.listTrips,
  });
  return (
    <Sidebar>
      <SidebarHeader>
        <SidebarMenuButton onClick={() => navigate({ to: "/" })}>
          <Plus /> New chat
        </SidebarMenuButton>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Trips</SidebarGroupLabel>
          <SidebarMenu>
            {trips.map((t) => (
              <SidebarMenuItem key={t.tripId}>
                <SidebarMenuButton asChild isActive={t.tripId === activeTripId}>
                  <Link to="/trips/$tripId" params={{ tripId: t.tripId }}>
                    {t.name}
                  </Link>
                </SidebarMenuButton>
              </SidebarMenuItem>
            ))}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <SidebarMenuButton>
          <Settings /> Settings
        </SidebarMenuButton>
      </SidebarFooter>
    </Sidebar>
  );
}
