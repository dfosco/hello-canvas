import BaseUiSelect from './BaseUiSelect.jsx'

function Frame({ children }) {
  return (
    <div className="flex items-start justify-center min-h-[200px] w-full p-6 bg-card text-card-foreground">
      <div className="w-full max-w-[240px]">{children}</div>
    </div>
  )
}

const fruits = [
  { value: 'apple', label: 'Apple' },
  { value: 'banana', label: 'Banana' },
  { value: 'cherry', label: 'Cherry' },
  { value: 'durian', label: 'Durian' },
]

const groupedFood = [
  {
    label: 'Fruits',
    items: [
      { value: 'apple', label: 'Apple' },
      { value: 'banana', label: 'Banana' },
    ],
  },
  {
    label: 'Vegetables',
    items: [
      { value: 'carrot', label: 'Carrot' },
      { value: 'spinach', label: 'Spinach' },
    ],
  },
]

export function Default() {
  return <Frame><BaseUiSelect label="Favorite fruit" items={fruits} defaultValue="banana" /></Frame>
}

export function WithGroups() {
  return <Frame><BaseUiSelect label="Pick a food" groups={groupedFood} defaultValue="carrot" /></Frame>
}
