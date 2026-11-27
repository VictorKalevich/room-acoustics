import { render } from 'preact';
import './styles.css';
import { App } from './App';

// V2-005: оболочка не регистрирует service worker, не пишет в хранилище, не обращается к микрофону и звуку
// (tests/v2/e2e/shell.spec.ts).
render(<App />, document.getElementById('app')!);
