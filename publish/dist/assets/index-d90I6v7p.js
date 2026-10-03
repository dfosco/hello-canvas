var x=Object.defineProperty;var o=(t,e)=>x(t,"name",{value:e,configurable:!0});import{A as g,i as M}from"./index-l9JkY8HF.js";import{bi as Pt}from"./index-l9JkY8HF.js";import"./vendor-primer-BiQOyOdk.js";import"./vendor-react-PJCXJ5Vl.js";import"./vendor-octicons-CJrzlmrh.js";const $="sb-comments-token",S="sb-comments-user",G="https://api.github.com/graphql";function T(){try{return localStorage.getItem($)}catch{return null}}o(T,"getToken");function st(t){localStorage.setItem($,t)}o(st,"setToken");function rt(){localStorage.removeItem($),localStorage.removeItem(S)}o(rt,"clearToken");function it(){try{const t=localStorage.getItem(S);return t?JSON.parse(t):null}catch{return null}}o(it,"getCachedUser");async function at(t){const e=await fetch("https://api.github.com/user",{headers:{Authorization:`bearer ${t}`}});if(!e.ok)throw new Error("Invalid token — GitHub returned "+e.status);const n=await e.json(),s=(e.headers.get("x-oauth-scopes")||"").split(",").map(i=>i.trim()).filter(Boolean),r={login:n.login,avatarUrl:n.avatar_url,scopes:s};return await U(t),localStorage.setItem(S,JSON.stringify(r)),r}o(at,"validateToken");async function U(t){const e=g();if(!e)return;const{owner:n,name:s}=e.repo;if(!n||!s)return;const r=`query { repository(owner: "${n}", name: "${s}") { id discussionCategories(first: 1) { nodes { id } } } }`,i=await fetch(G,{method:"POST",headers:{Authorization:`bearer ${t}`,"Content-Type":"application/json"},body:JSON.stringify({query:r})});if(i.status===401)throw new Error("Token is invalid or expired.");if(!i.ok)throw new Error(`GitHub API error: ${i.status}`);const c=await i.json();if(c.errors?.length){const a=c.errors.map(u=>u.message).join(", ");throw a.includes("not accessible")||a.includes("insufficient")?new Error(`Token doesn't have access to ${n}/${s} discussions. Fine-grained tokens need "Discussions: Read and write". Classic tokens need the "repo" scope.`):new Error(`GitHub API error: ${a}`)}if(!c.data?.repository)throw new Error(`Repository ${n}/${s} not found. Check that the token has access to this repository.`);if(!c.data.repository.discussionCategories?.nodes?.length)throw new Error(`No discussion categories found in ${n}/${s}. Enable Discussions in the repository settings.`)}o(U,"validateTokenPermissions");function P(){return T()!==null}o(P,"isAuthenticated");let y=!1;const C=new Set;function ct(){return y}o(ct,"isCommentModeActive");function dt(){return M()?!y&&!P()?(console.warn("[storyboard] Sign in first to use comments"),!1):(y=!y,v(),y):(console.warn("[storyboard] Comments not enabled — check storyboard.config.json"),!1)}o(dt,"toggleCommentMode");function ut(t){y=t,v()}o(ut,"setCommentMode");function mt(t){return C.add(t),()=>C.delete(t)}o(mt,"subscribeToCommentMode");function v(){for(const t of C)t(y)}o(v,"_notify");const E=/<!--\s*sb-meta\s+(\{.*?\})\s*-->/;function m(t){if(!t)return{meta:null,text:""};const e=t.match(E);if(!e)return{meta:null,text:t.trim()};try{const n=JSON.parse(e[1]),s=t.replace(E,"").trim();return{meta:n,text:s}}catch{return{meta:null,text:t.trim()}}}o(m,"parseMetadata");function f(t,e){return`${`<!-- sb-meta ${JSON.stringify(t)} -->`}
${e}`}o(f,"serializeMetadata");function H(t,e){const{meta:n,text:s}=m(t),r={...n,...e};return f(r,s)}o(H,"updateMetadata");const q="https://api.github.com/graphql";async function d(t,e={},n={}){const{retries:s=2}=n,r=T();if(!r)throw new Error("Not authenticated — no GitHub PAT found. Please sign in.");let i;for(let c=0;c<=s;c++)try{const a=await fetch(q,{method:"POST",headers:{Authorization:`bearer ${r}`,"Content-Type":"application/json"},body:JSON.stringify({query:t,variables:e})});if(a.status===401)throw new Error("GitHub PAT is invalid or expired. Please sign in again.");if(!a.ok)throw new Error(`GitHub API error: ${a.status} ${a.statusText}`);const u=await a.json();if(u.errors?.length)throw new Error(`GraphQL error: ${u.errors.map(l=>l.message).join(", ")}`);return u.data}catch(a){if(i=a,a.message.includes("401")||a.message.includes("Not authenticated")||a.message.includes("invalid or expired"))throw a;c<s&&await new Promise(u=>setTimeout(u,1e3*(c+1)))}throw i}o(d,"graphql");const j=`
  query SearchDiscussion($query: String!) {
    search(query: $query, type: DISCUSSION, first: 1) {
      nodes {
        ... on Discussion {
          id
          title
          body
          url
          comments(first: 100) {
            nodes {
              id
              body
              createdAt
              author {
                login
                avatarUrl
              }
              replies(first: 50) {
                nodes {
                  id
                  body
                  createdAt
                  author {
                    login
                    avatarUrl
                  }
                  reactionGroups {
                    content
                    users(first: 0) { totalCount }
                    viewerHasReacted
                  }
                }
              }
              reactionGroups {
                content
                users(first: 0) { totalCount }
                viewerHasReacted
              }
            }
          }
        }
      }
    }
  }
`,k=`
  query SearchDiscussionLightweight($query: String!) {
    search(query: $query, type: DISCUSSION, first: 1) {
      nodes {
        ... on Discussion {
          id
          title
          url
          comments(first: 100) {
            nodes {
              id
              body
              author {
                login
                avatarUrl
              }
            }
          }
        }
      }
    }
  }
`,L=`
  query GetCommentDetail($id: ID!) {
    node(id: $id) {
      ... on DiscussionComment {
        id
        body
        createdAt
        discussion {
          id
        }
        author {
          login
          avatarUrl
        }
        replies(first: 50) {
          nodes {
            id
            body
            createdAt
            author {
              login
              avatarUrl
            }
            reactionGroups {
              content
              users(first: 0) { totalCount }
              viewerHasReacted
            }
          }
        }
        reactionGroups {
          content
          users(first: 0) { totalCount }
          viewerHasReacted
        }
      }
    }
  }
`,J=`
  query GetCategoryId($owner: String!, $name: String!, $slug: String!) {
    repository(owner: $owner, name: $name) {
      id
      discussionCategory(slug: $slug) {
        id
      }
      discussionCategories(first: 25) {
        nodes {
          id
          name
          slug
        }
      }
    }
  }
`,B=`
  mutation CreateDiscussion($repositoryId: ID!, $categoryId: ID!, $title: String!, $body: String!) {
    createDiscussion(input: { repositoryId: $repositoryId, categoryId: $categoryId, title: $title, body: $body }) {
      discussion {
        id
        title
        url
      }
    }
  }
`,K=`
  mutation AddComment($discussionId: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussionId, body: $body }) {
      comment {
        id
        body
        createdAt
        author {
          login
          avatarUrl
        }
      }
    }
  }
`,Y=`
  mutation AddReply($discussionId: ID!, $replyToId: ID!, $body: String!) {
    addDiscussionComment(input: { discussionId: $discussionId, body: $body, replyToId: $replyToId }) {
      comment {
        id
        body
        createdAt
        author {
          login
          avatarUrl
        }
      }
    }
  }
`,p=`
  mutation UpdateComment($commentId: ID!, $body: String!) {
    updateDiscussionComment(input: { commentId: $commentId, body: $body }) {
      comment {
        id
        body
      }
    }
  }
`,z=`
  mutation DeleteComment($commentId: ID!) {
    deleteDiscussionComment(input: { id: $commentId }) {
      comment {
        id
      }
    }
  }
`,F=`
  mutation AddReaction($subjectId: ID!, $content: ReactionContent!) {
    addReaction(input: { subjectId: $subjectId, content: $content }) {
      reaction {
        content
      }
    }
  }
`,Q=`
  mutation RemoveReaction($subjectId: ID!, $content: ReactionContent!) {
    removeReaction(input: { subjectId: $subjectId, content: $content }) {
      reaction {
        content
      }
    }
  }
`,X=`
  query ListDiscussions($owner: String!, $name: String!, $categoryId: ID!) {
    repository(owner: $owner, name: $name) {
      discussions(first: 50, categoryId: $categoryId) {
        nodes {
          id
          title
          body
          url
          createdAt
          comments {
            totalCount
          }
        }
      }
    }
  }
`;async function W(t){const e=g(),s=`"${`Comments: ${t}`}" in:title repo:${e.repo.owner}/${e.repo.name}`,i=(await d(j,{query:s})).search?.nodes?.[0];if(!i)return null;const c=(i.comments?.nodes??[]).map(a=>{const{meta:u,text:l}=m(a.body);return{...a,meta:u,text:l,replies:(a.replies?.nodes??[]).map(I=>{const{meta:D,text:_}=m(I.body);return{...I,meta:D,text:_}})}});return{...i,comments:c}}o(W,"fetchRouteDiscussion");async function lt(t){const e=g(),s=`"${`Comments: ${t}`}" in:title repo:${e.repo.owner}/${e.repo.name}`,i=(await d(k,{query:s})).search?.nodes?.[0];if(!i)return null;const c=(i.comments?.nodes??[]).map(a=>{const{meta:u,text:l}=m(a.body);return{...a,meta:u,text:l}});return{...i,comments:c}}o(lt,"fetchRouteCommentsSummary");async function yt(t){const n=(await d(L,{id:t})).node;if(!n)return null;const{meta:s,text:r}=m(n.body),i=(n.replies?.nodes??[]).map(c=>{const{meta:a,text:u}=m(c.body);return{...c,meta:a,text:u}});return{...n,discussionId:n.discussion?.id??null,meta:s,text:r,replies:i}}o(yt,"fetchCommentDetail");async function R(){const t=g(),e=t.discussions.category.toLowerCase().replace(/\s+/g,"-"),n=await d(J,{owner:t.repo.owner,name:t.repo.name,slug:e}),s=n.repository?.id;let r=n.repository?.discussionCategory?.id;if(r||(r=n.repository?.discussionCategories?.nodes?.find(c=>c.name===t.discussions.category)?.id),!s||!r)throw new Error(`Could not find repository or discussion category "${t.discussions.category}" in ${t.repo.owner}/${t.repo.name}`);return{repositoryId:s,categoryId:r}}o(R,"getRepoAndCategoryIds");async function ft(t,e,n,s){let r=await W(t);if(!r){const{repositoryId:a,categoryId:u}=await R(),l=`Comments: ${t}`,I=f({route:t,createdAt:new Date().toISOString()},"");r=(await d(B,{repositoryId:a,categoryId:u,title:l,body:I})).createDiscussion.discussion}const i=f({x:Math.round(e*10)/10,y:Math.round(n*10)/10},s);return(await d(K,{discussionId:r.id,body:i})).addDiscussionComment.comment}o(ft,"createComment");async function gt(t,e,n){return(await d(Y,{discussionId:t,replyToId:e,body:n})).addDiscussionComment.comment}o(gt,"replyToComment");async function pt(t,e){const{meta:n,text:s}=m(e),r={...n,resolved:!0},i=s.startsWith("(Resolved) ")?s:`(Resolved) ${s}`,c=f(r,i);return(await d(p,{commentId:t,body:c})).updateDiscussionComment.comment}o(pt,"resolveComment");async function It(t,e){const{meta:n,text:s}=m(e),r={...n};delete r.resolved;const i=s.replace(/^\(Resolved\)\s*/,""),c=f(r,i);return(await d(p,{commentId:t,body:c})).updateDiscussionComment.comment}o(It,"unresolveComment");async function ht(t,e,n){const{meta:s}=m(e),r=s?f(s,n):n;return(await d(p,{commentId:t,body:r})).updateDiscussionComment.comment}o(ht,"editComment");async function wt(t,e){return(await d(p,{commentId:t,body:e})).updateDiscussionComment.comment}o(wt,"editReply");async function Ct(t,e,n,s){const r=H(e,{x:Math.round(n*10)/10,y:Math.round(s*10)/10});return(await d(p,{commentId:t,body:r})).updateDiscussionComment.comment}o(Ct,"moveComment");async function $t(t){await d(z,{commentId:t})}o($t,"deleteComment");async function St(t,e){await d(F,{subjectId:t,content:e})}o(St,"addReaction");async function bt(t,e){await d(Q,{subjectId:t,content:e})}o(bt,"removeReaction");async function Dt(){const t=g(),{categoryId:e}=await R();return(await d(X,{owner:t.repo.owner,name:t.repo.name,categoryId:e})).repository?.discussions?.nodes??[]}o(Dt,"listDiscussions");const h="sb-comments:",V=120*1e3;function Et(t){try{const e=localStorage.getItem(h+t);if(!e)return null;const n=JSON.parse(e);return Date.now()-n.ts>V?(localStorage.removeItem(h+t),null):n.data}catch{return null}}o(Et,"getCachedComments");function Tt(t,e){try{localStorage.setItem(h+t,JSON.stringify({ts:Date.now(),data:e}))}catch{}}o(Tt,"setCachedComments");function vt(t){try{localStorage.removeItem(h+t)}catch{}}o(vt,"clearCachedComments");const w="sb-pending-comments:";function Rt(t,e){try{const n=A(t),s=n.findIndex(r=>r.id===e.id);s>=0?n[s]=e:n.push(e),localStorage.setItem(w+t,JSON.stringify(n))}catch{}}o(Rt,"savePendingComment");function A(t){try{const e=localStorage.getItem(w+t);return e?JSON.parse(e):[]}catch{return[]}}o(A,"getPendingComments");function At(t,e){try{const n=A(t).filter(s=>s.id!==e);n.length>0?localStorage.setItem(w+t,JSON.stringify(n)):localStorage.removeItem(w+t)}catch{}}o(At,"removePendingComment");const O="sb-comment-drafts";function b(){try{return JSON.parse(localStorage.getItem(O)||"{}")}catch{return{}}}o(b,"readDrafts");function N(t){try{localStorage.setItem(O,JSON.stringify(t))}catch{}}o(N,"writeDrafts");function Ot(t,e){const n=b();n[t]=e,N(n)}o(Ot,"saveDraft");function Nt(t){return b()[t]??null}o(Nt,"getDraft");function _t(t){const e=b();delete e[t],N(e)}o(_t,"clearDraft");function xt(t){return`comment:${t}`}o(xt,"composerDraftKey");function Mt(t){return`reply:${t}`}o(Mt,"replyDraftKey");export{St as addReaction,vt as clearCachedComments,_t as clearDraft,rt as clearToken,xt as composerDraftKey,ft as createComment,$t as deleteComment,ht as editComment,wt as editReply,yt as fetchCommentDetail,lt as fetchRouteCommentsSummary,W as fetchRouteDiscussion,Et as getCachedComments,it as getCachedUser,g as getCommentsConfig,Nt as getDraft,A as getPendingComments,T as getToken,d as graphql,Pt as initCommentsConfig,P as isAuthenticated,ct as isCommentModeActive,M as isCommentsEnabled,Dt as listDiscussions,Ct as moveComment,m as parseMetadata,At as removePendingComment,bt as removeReaction,Mt as replyDraftKey,gt as replyToComment,pt as resolveComment,Ot as saveDraft,Rt as savePendingComment,f as serializeMetadata,Tt as setCachedComments,ut as setCommentMode,st as setToken,mt as subscribeToCommentMode,dt as toggleCommentMode,It as unresolveComment,H as updateMetadata,at as validateToken};
