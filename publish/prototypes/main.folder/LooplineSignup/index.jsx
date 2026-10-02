import '../../../assets/hello-canvas.css'
import Branding from './Branding'
import SignupForm from './SignupForm'

export default function StartupSignup() {
  // Layout direction knob disabled — layout is fixed to horizontal for now.
  // const layoutDirection = useKnob('layoutDirection') ?? 'horizontal'
  // const isVerticalLayout = layoutDirection === 'vertical'
  const isVerticalLayout = false

  return (
    <main
      className={`grid min-h-screen grid-cols-1 ${
        isVerticalLayout ? 'lg:grid-rows-2' : 'lg:grid-cols-2'
      }`}
    >
      <Branding />
      <SignupForm />
    </main>
  )
}
