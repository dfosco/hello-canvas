var p=Object.defineProperty;var i=(e,r)=>p(e,"name",{value:r,configurable:!0});import{a as t}from"./vendor-primer-BiQOyOdk.js";/* empty css                     */import{D as c,a as u,b as x,c as g,d as f}from"./DialogTrigger-BglWDBoo.js";import{D as b,a}from"./DialogTitle-C30ZNJZz.js";import{D as y}from"./DialogDescription-eM7Fdy-y.js";import"./vendor-react-PJCXJ5Vl.js";import"./vendor-octicons-CJrzlmrh.js";import"./useBaseUiId-CavJVjrK.js";import"./popupStateMapping-Cj9kdg8z.js";import"./useStableCallback-CFaNPKxr.js";import"./addEventListener-BvU6rCZ1.js";import"./detectBrowser-U0mYH9m3.js";import"./visuallyHidden-COI6QeQH.js";import"./owner-DLmwGraE.js";import"./shadowDom-3gKEInjV.js";import"./composite-CbmMl_PA.js";import"./event-D8rDLheZ.js";import"./constants-CRqqCNE_.js";import"./useTimeout-Dum85bP9.js";import"./useOnMount-BZ9KFtEQ.js";import"./element-D4E01JQz.js";import"./index-BFcHPlhU.js";import"./useOpenChangeComplete-zuOA6A4-.js";import"./useAnimationFrame-C0UWks3q.js";import"./composite-f6uh1mdh.js";import"./useScrollLock-CMAWfhOD.js";import"./useValueAsRef-D9sunwhk.js";import"./useValueChanged-Ctbf0PJr.js";import"./inertValue-B0t33dtA.js";import"./useSyncedFloatingRootContext-Bsw0jjRi.js";import"./useButton-D3jZFwgs.js";function s({trigger:e="Open",title:r,description:o,children:n,primaryLabel:l="Confirm",cancelLabel:d="Cancel"}){return t.jsxs(c,{children:[t.jsx(u,{className:`
          inline-flex items-center justify-center
          rounded-md border border-input bg-background px-3 py-1.5
          text-sm font-medium text-foreground transition-colors
          hover:bg-muted
          focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
        `,children:e}),t.jsxs(x,{children:[t.jsx(g,{className:`
            fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm
            data-[starting-style]:opacity-0 data-[ending-style]:opacity-0
            transition-opacity duration-150
          `}),t.jsxs(f,{className:`
            fixed left-1/2 top-1/2 z-50 w-[min(420px,90vw)]
            -translate-x-1/2 -translate-y-1/2
            rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl
            data-[starting-style]:opacity-0 data-[starting-style]:scale-95
            data-[ending-style]:opacity-0 data-[ending-style]:scale-95
            transition-[opacity,transform] duration-150
          `,children:[r&&t.jsx(b,{className:"m-0 text-base font-semibold",children:r}),o&&t.jsx(y,{className:"mt-2 text-sm text-muted-foreground",children:o}),n&&t.jsx("div",{className:"mt-3 text-sm text-foreground",children:n}),t.jsxs("div",{className:"mt-5 flex justify-end gap-2",children:[t.jsx(a,{className:`
                inline-flex items-center justify-center
                rounded-md border border-input bg-background px-3 py-1.5
                text-sm font-medium text-foreground transition-colors
                hover:bg-muted
              `,children:d}),t.jsx(a,{className:`
                inline-flex items-center justify-center
                rounded-md bg-ring px-3 py-1.5
                text-sm font-medium text-background transition-opacity
                hover:opacity-90
              `,children:l})]})]})]})]})}i(s,"BaseUiDialog");function m({children:e}){return t.jsx("div",{className:"flex items-center justify-center min-h-[160px] min-w-[220px] p-6 bg-card text-card-foreground",children:e})}i(m,"Frame");function Z(){return t.jsx(m,{children:t.jsx(s,{trigger:"Open dialog",title:"Invite teammates",description:"They'll get an email with a link to join the workspace.",primaryLabel:"Send invites"})})}i(Z,"Default");function _(){return t.jsx(m,{children:t.jsx(s,{trigger:"Delete project",title:"Delete project?",description:"This action cannot be undone. The project and all its data will be permanently removed.",primaryLabel:"Delete"})})}i(_,"Destructive");export{Z as Default,_ as Destructive};
