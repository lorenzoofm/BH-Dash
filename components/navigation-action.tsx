"use client";
export function NavigationAction({navigation,children,...props}:any){return <a {...props} href={navigation?.destination||'/'}>{children}</a>;}
