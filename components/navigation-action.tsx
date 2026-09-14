"use client";
export function NavigationAction({action,children,...props}:any){return <a {...props} href={action?.destination||'/'}>{children}</a>;}
