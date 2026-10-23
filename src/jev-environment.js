// Windows environment names are case-insensitive. Keep harness authentication
// and ordinary host variables, but never give an Agent the Jev key namespace.
export function withoutJevCredentials(env){
 return Object.fromEntries(Object.entries(env).filter(([name])=>!/^(TYPESAFE|JEV)_/i.test(name)));
}
export function snapshotJevEnvironment(env){
 const result={...env};
 // Preserve the original host lookup semantics before losing process.env's
 // Windows case-insensitive behavior in a plain snapshot. POSIX names stay distinct.
 for(const name of Object.keys(env))if(/^(TYPESAFE|JEV)_/i.test(name)){
  const canonical=name.toUpperCase();if(env[canonical]!==undefined)result[canonical]=env[canonical];
 }
 return result;
}
