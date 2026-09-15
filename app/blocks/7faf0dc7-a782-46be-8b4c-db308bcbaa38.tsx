"use client";
import { useCurrentUser } from "@/lib/user";
import { useTextSetting, useNavigationSetting, useImageSetting } from "@/lib/editable-settings";
import { NavigationAction } from "@/components/navigation-action";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import {
  Users,
  Clock,
  Target,
  Receipt,
  DollarSign,
  Scale,
  CalendarDays,
} from "lucide-react";

function startOfDay(d: Date) {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate());
}

// Monday-start week, matching the pay/conversion weeks used elsewhere in the app.
function mondayOf(d: Date) {
  const x = startOfDay(d);
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}

function fmt(d: Date, opts: Intl.DateTimeFormatOptions) {
  return d.toLocaleDateString("en-GB", opts);
}

export default function Block() {
  const user = useCurrentUser();

  const brand = useTextSetting({
    name: "brand",
    label: "Brand name",
    initialValue: "20MG Black Hat Operations",
  });
  const logo = useImageSetting({
    name: "logo",
    label: "Logo (square)",
    initialValue: { src: "/20mg.png", alt: "20MG" },
  });
  const subtitle = useTextSetting({
    name: "subtitle",
    label: "Subtitle",
    initialValue: "Staff hours, pay and conversions — one place.",
  });

  // Every destination in the app is an editable navigation setting.
  const homeNav = useNavigationSetting({
    name: "nav-home",
    label: "Brand / Home link",
    initialValue: { action: "OPEN_PAGE", destination: "/", openIn: "SELF" },
  });
  const staffNav = useNavigationSetting({
    name: "nav-staff",
    label: "Staff link",
    initialValue: { action: "OPEN_PAGE", destination: "/staff", openIn: "SELF" },
  });
  const hoursNav = useNavigationSetting({
    name: "nav-hours",
    label: "Pay & Hours link",
    initialValue: { action: "OPEN_PAGE", destination: "/pay-hours", openIn: "SELF" },
  });
  const convNav = useNavigationSetting({
    name: "nav-conversions",
    label: "Conversions link",
    initialValue: { action: "OPEN_PAGE", destination: "/conversions", openIn: "SELF" },
  });
  const expensesNav = useNavigationSetting({
    name: "nav-expenses",
    label: "Expenses link",
    initialValue: { action: "OPEN_PAGE", destination: "/expenses", openIn: "SELF" },
  });
  const revenueNav = useNavigationSetting({
    name: "nav-revenue",
    label: "Revenue link",
    initialValue: { action: "OPEN_PAGE", destination: "/revenue", openIn: "SELF" },
  });
  const pnlNav = useNavigationSetting({
    name: "nav-pnl",
    label: "P&L link",
    initialValue: { action: "OPEN_PAGE", destination: "/pnl", openIn: "SELF" },
  });

  const groups = [
    {
      label: "Operations",
      links: [
        { key: "staff", label: "Staff", nav: staffNav, Icon: Users },
        { key: "hours", label: "Pay & Hours", nav: hoursNav, Icon: Clock },
        { key: "conversions", label: "Conversions", nav: convNav, Icon: Target },
      ],
    },
    {
      label: "Finance",
      links: [
        { key: "expenses", label: "Expenses", nav: expensesNav, Icon: Receipt },
        { key: "revenue", label: "Revenue", nav: revenueNav, Icon: DollarSign },
        { key: "pnl", label: "P&L", nav: pnlNav, Icon: Scale },
      ],
    },
  ];

  const now = new Date();
  const today = startOfDay(now);
  const weekStart = mondayOf(today);
  const weekEnd = new Date(weekStart);
  weekEnd.setDate(weekEnd.getDate() + 6);
  const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, "0")}`;
  const hour = now.getHours();
  const greeting = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
  const name = user?.firstName || user?.fullName || "";

  return (
    <div className="w-full px-4 pt-6 sm:px-6 lg:px-8">
      <Card className="w-full gap-0 overflow-hidden rounded-xl border bg-card p-0 shadow-sm">
        {/* Identity row */}
        <div className="flex flex-col gap-3 px-4 py-4 sm:px-6 md:flex-row md:items-center md:justify-between md:gap-6">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-x-2.5 gap-y-1">
              <Button
                asChild
                variant="ghost"
                className="-ml-2 h-auto max-w-full gap-2.5 whitespace-normal rounded-lg px-2 py-1.5 text-left"
              >
                <NavigationAction navigation={homeNav}>
                  {logo.src ? (
                    <img
                      src={logo.src}
                      alt={logo.alt || brand}
                      className="h-9 w-9 shrink-0 rounded-lg border object-cover"
                    />
                  ) : (
                    <span className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-primary/10 text-xs font-semibold text-primary">
                      20
                    </span>
                  )}
                  <span className="min-w-0 break-words text-xl font-semibold tracking-tight">
                    {brand}
                  </span>
                </NavigationAction>
              </Button>
              <span className="rounded-md bg-muted px-2 py-0.5 text-sm font-medium tabular-nums text-muted-foreground">
                {period}
              </span>
            </div>
            <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
          </div>

          <div className="flex shrink-0 flex-col gap-0.5 md:items-end">
            <span className="text-sm font-medium">
              {greeting}
              {name ? `, ${name}` : ""}
            </span>
            <span className="inline-flex items-center gap-1.5 text-xs tabular-nums text-muted-foreground">
              <CalendarDays className="h-3.5 w-3.5 opacity-60" />
              {fmt(today, { weekday: "short", day: "numeric", month: "short" })}
              <span className="opacity-40">·</span>
              Week {fmt(weekStart, { day: "numeric", month: "short" })} –{" "}
              {fmt(weekEnd, { day: "numeric", month: "short" })}
            </span>
          </div>
        </div>

        {/* Navigation row */}
        <div className="flex flex-col gap-3 border-t bg-muted/40 px-4 py-3 sm:px-6 lg:flex-row lg:flex-wrap lg:items-center lg:gap-x-5">
          {groups.map((group, i) => (
            <div key={group.label} className="flex flex-wrap items-center gap-2">
              {i > 0 && <span className="hidden h-5 w-px bg-border lg:block" aria-hidden="true" />}
              <span className="text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                {group.label}
              </span>
              {group.links.map((link) => (
                <Button
                  key={link.key}
                  asChild
                  variant="outline"
                  size="sm"
                  className="h-8 gap-1.5 rounded-lg border-dashed bg-background px-2.5 text-xs font-medium"
                >
                  <NavigationAction navigation={link.nav}>
                    <link.Icon className="h-3.5 w-3.5 opacity-60" />
                    {link.label}
                  </NavigationAction>
                </Button>
              ))}
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}
