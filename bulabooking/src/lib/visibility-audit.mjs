// Technical readiness checklist, not a claim of Google/Bing/AI ranking.
export const VISIBILITY_CHECKS=Object.freeze(['indexable','canonical','sitemap','server_rendered_content','unique_title','meta_description','structured_data_valid','mobile_usable','internal_links','verified_operator_facts','image_alt_text','booking_cta_clear']);
export function evaluateListingVisibility(input){
 if(!input||typeof input!=='object')throw Error('Missing audit input');
 const checks={};
 for(const key of VISIBILITY_CHECKS)checks[key]=input[key]===true?'pass':input[key]===false?'fail':'unknown';
 const known=Object.values(checks).filter(x=>x!=='unknown');
 const passed=known.filter(x=>x==='pass').length;
 return {checks,passed,failed:known.length-passed,unknown:VISIBILITY_CHECKS.length-known.length,readinessPercent:known.length?Math.round(100*passed/known.length):null,warning:'Technical readiness is not a search ranking, indexing guarantee, AI citation count or traffic measurement.'};
}
