import { tr, getLocale } from '../../i18n/index';
import { icon } from '../dom';

export function languageControl(id: string) {
  return `<label class="language-control" for="${id}" title="${tr('Sprache wählen', 'Choose language')}">${icon('languages')}<select id="${id}" data-language-select aria-label="${tr('Sprache wählen', 'Choose language')}">
    <option value="de" lang="de" ${getLocale() === 'de' ? 'selected' : ''}>DE</option>
    <option value="en" lang="en" ${getLocale() === 'en' ? 'selected' : ''}>EN</option>
    </select>
    </label>`;
}
