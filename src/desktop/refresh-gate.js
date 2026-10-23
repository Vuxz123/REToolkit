// Serialize snapshot reads while retaining a refresh requested during an active
// read. Callers share a promise that settles after the final requested read.
export function createRefreshGate(read){
 let active,requested=false;
 async function drain(){
  let result,failure,failed=false;
  try{
   do{
    requested=false;
    try{result=await read();failed=false;failure=undefined;}
    catch(error){failed=true;failure=error;}
   }while(requested);
   if(failed)throw failure;
   return result;
  }finally{active=undefined;}
 }
 return function refresh(){
  requested=true;
  // Scheduling also ensures a synchronously reentrant read sees active set.
  if(!active)active=Promise.resolve().then(drain);
  return active;
 };
}
