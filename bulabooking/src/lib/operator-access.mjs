// Explicit tenant-scoping helpers for a future authenticated API.
// These are NOT authentication or authorization middleware.
export function requireOperatorScope(session,operatorId){
 if(!session||session.authenticated!==true||typeof session.userId!=='string'||!session.userId)throw new Error('Authentication required');
 if(typeof operatorId!=='string'||!operatorId)throw new Error('Invalid operator');
 if(!Array.isArray(session.operatorIds)||!session.operatorIds.includes(operatorId))throw new Error('Access denied');
 return {operatorId,actorId:session.userId};
}
export function requireStaffScope(session){
 if(!session||session.authenticated!==true||!Array.isArray(session.roles)||!session.roles.includes('marketplace_staff'))throw new Error('Staff authorization required');
 return {actorId:session.userId};
}
