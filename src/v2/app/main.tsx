import { render } from 'preact';
import '@fontsource-variable/inter/wght.css';
import './styles.css';
import { applyTheme, readTheme } from '../design-system/theme';
import { App } from './App';

// Тема — до первой отрисовки, чтобы не мигала (R12).
applyTheme(readTheme());
render(<App />, document.getElementById('app')!);
