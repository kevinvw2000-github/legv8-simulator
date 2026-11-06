import './style.css';
import { App } from './ui/app';

const root = document.querySelector<HTMLElement>('#app');
if (root) new App(root);
