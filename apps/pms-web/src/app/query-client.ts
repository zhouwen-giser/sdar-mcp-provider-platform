import { QueryClient } from "@tanstack/react-query";
import { toUiProblem } from "../shared/errors/ui-problem.js";
export const queryClient=new QueryClient({defaultOptions:{queries:{staleTime:15_000,gcTime:5*60_000,retry:(count: number,error: unknown)=>toUiProblem(error).retryable&&count<2,refetchOnWindowFocus:true},mutations:{retry:0}}});
