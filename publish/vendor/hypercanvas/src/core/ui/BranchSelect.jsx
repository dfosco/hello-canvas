import css from './BranchSelect.module.css'

export default function BranchSelect({
  branches = [],
  value,
  onChange,
  disabled,
  id,
  placeholder,
  ref,
}) {
  return (
    <select
      ref={ref}
      id={id}
      className={css.select}
      value={value}
      onChange={onChange}
      disabled={disabled}
    >
      {branches.length === 0 && (
        <option value="" disabled>{placeholder || 'No branches available'}</option>
      )}
      {branches.map((branch) => (
        <option key={branch} value={branch}>{branch}</option>
      ))}
    </select>
  )
}
