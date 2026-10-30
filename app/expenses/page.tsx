import {requirePage} from '@/app/require-page';
import Expenses from "@/views/expenses";
export default async function Page(){await requirePage('expenses');return <Expenses/>;}
