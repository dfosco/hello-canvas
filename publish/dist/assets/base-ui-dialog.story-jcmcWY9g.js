var c=Object.defineProperty;var n=(t,r)=>c(t,"name",{value:r,configurable:!0});import{a as e}from"./vendor-primer-Dsbk7Mdi.js";/* empty css                     */import{D as p}from"./DialogRoot-D37wUk9x.js";import{ak as u,al as x,am as g,an as f}from"./index-_QFiCn0r.js";import{D as b,a}from"./DialogTitle-Bcv2h7tp.js";import{D as y}from"./DialogDescription-DhZG2Kob.js";import"./vendor-react-V2nlQIQI.js";import"./vendor-octicons-Cog3s9UM.js";function s({trigger:t="Open",title:r,description:i,children:o,primaryLabel:d="Confirm",cancelLabel:m="Cancel"}){return e.jsxs(p,{children:[e.jsx(u,{className:`
          inline-flex items-center justify-center
          rounded-md border border-input bg-background px-3 py-1.5
          text-sm font-medium text-foreground transition-colors
          hover:bg-muted
          focus-visible:outline-2 focus-visible:outline-ring focus-visible:outline-offset-2
        `,children:t}),e.jsxs(x,{children:[e.jsx(g,{className:`
            fixed inset-0 z-40 bg-foreground/30 backdrop-blur-sm
            data-[starting-style]:opacity-0 data-[ending-style]:opacity-0
            transition-opacity duration-150
          `}),e.jsxs(f,{className:`
            fixed left-1/2 top-1/2 z-50 w-[min(420px,90vw)]
            -translate-x-1/2 -translate-y-1/2
            rounded-lg border border-border bg-popover p-5 text-popover-foreground shadow-xl
            data-[starting-style]:opacity-0 data-[starting-style]:scale-95
            data-[ending-style]:opacity-0 data-[ending-style]:scale-95
            transition-[opacity,transform] duration-150
          `,children:[r&&e.jsx(b,{className:"m-0 text-base font-semibold",children:r}),i&&e.jsx(y,{className:"mt-2 text-sm text-muted-foreground",children:i}),o&&e.jsx("div",{className:"mt-3 text-sm text-foreground",children:o}),e.jsxs("div",{className:"mt-5 flex justify-end gap-2",children:[e.jsx(a,{className:`
                inline-flex items-center justify-center
                rounded-md border border-input bg-background px-3 py-1.5
                text-sm font-medium text-foreground transition-colors
                hover:bg-muted
              `,children:m}),e.jsx(a,{className:`
                inline-flex items-center justify-center
                rounded-md bg-ring px-3 py-1.5
                text-sm font-medium text-background transition-opacity
                hover:opacity-90
              `,children:d})]})]})]})]})}n(s,"BaseUiDialog");function l({children:t}){return e.jsx("div",{className:"flex items-center justify-center min-h-[160px] min-w-[220px] p-6 bg-card text-card-foreground",children:t})}n(l,"Frame");function z(){return e.jsx(l,{children:e.jsx(s,{trigger:"Open dialog",title:"Invite teammates",description:"They'll get an email with a link to join the workspace.",primaryLabel:"Send invites"})})}n(z,"Default");function B(){return e.jsx(l,{children:e.jsx(s,{trigger:"Delete project",title:"Delete project?",description:"This action cannot be undone. The project and all its data will be permanently removed.",primaryLabel:"Delete"})})}n(B,"Destructive");export{z as Default,B as Destructive};
