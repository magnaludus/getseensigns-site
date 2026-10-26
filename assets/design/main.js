// Entry module for the designer pages.
import { boot } from './app.js';

const root = document.getElementById('designer');
if (root) boot(root);
