// Every string the rebuilt interface shows, in one file, so it can be reviewed as a whole.
// Rules (docs/PROMPT-UI.md, "Words"): sentence case; verbs on buttons; no exclamation marks; an error
// says what happened and what to do next; an empty state has one line and one action.
// test/strings.test.mjs scans this file for the banned words. The product name is the one exemption,
// pending a decision (docs/UI-STRINGS.md, open question 1); it appears here and nowhere else.

export const PRODUCT = 'holo-git';

export const S = {
  common: {
    cancel: 'Cancel', close: 'Close', save: 'Save changes', continue: 'Continue', back: 'Back', copy: 'Copy', copied: 'Copied', loading: 'Loading',
    skip: 'Skip to content', offline: 'Offline', notPublished: 'Not published', you: 'you', owner: 'Owner',
    opened: 'Open', closed: 'Closed', merged: 'Merged', draft: 'Draft', verified: 'Verified',
    previous: 'Previous', next: 'Next', pagination: 'Pagination', menu: 'Menu',
  },
  header: {
    home: 'Homepage', search: 'Search', searchPlaceholder: 'Type / to search', issues: 'Issues', pulls: 'Pull requests', explore: 'Explore', notifications: 'Notifications',
    create: 'Create new', newRepository: 'New repository', openRepository: 'Open repository', newOrganization: 'New organization',
    account: 'Open user menu', signedInAs: 'Signed in as', yourProfile: 'Your profile', settings: 'Settings', shortcuts: 'Keyboard shortcuts', gallery: 'Component gallery', getStarted: 'Get started',
    navigation: 'Global',
  },
  footer: { about: 'About', shortcuts: 'Keyboard shortcuts' },
  about: {
    title: `About ${PRODUCT}`,
    lead: 'Git hosting that runs in your browser. Your repositories stay in this browser until you publish them.',
    verified: 'Everything shown here was verified in this browser.',
    version: 'Version', integrity: 'Integrity value', integrityHint: 'Compare this with the value published for the release you expect.',
    noOffline: 'Offline use is not available in this browser.', updateReady: 'A new version is available.', update: 'Update and reload',
    unavailable: 'Not available yet',
  },
  shortcuts: {
    title: 'Keyboard shortcuts', site: 'Site-wide', repository: 'Repositories',
    focusSearch: 'Focus the search box', help: 'Show this dialog', goHome: 'Go to the homepage', goSettings: 'Go to settings', goCode: 'Go to Code', goPulls: 'Go to Pull requests',
    submit: 'Submit a form', closeDialog: 'Close a dialog or menu', then: 'then',
  },
  landing: {
    title: 'Git hosting that runs in your browser', lead: 'Create repositories, review changes and merge them. Nothing to install and no account to register.', action: 'Get started',
  },
  home: {
    title: 'Repositories', filter: 'Find a repository', new: 'New', open: 'Open by address',
    empty: 'You have no repositories yet.', emptyAction: 'Create a repository', noMatch: 'No repositories match your search.',
    updated: (when) => `Updated ${when}`, local: 'Only in this browser',
  },
  welcome: {
    title: 'Welcome', steps: ['Your name', 'Sign-in key', 'First repository'], progress: 'Set-up steps',
    nameTitle: 'Choose a name', nameLead: 'This is how your commits and comments are signed.',
    name: 'Name', email: 'Email', emailHint: 'Recorded in your commits. It is not verified and no mail is sent.',
    nameBlank: "Name can't be blank", nameChars: "Name can't contain < or > characters", emailInvalid: 'Enter an email address, like name@example.org',
    keyTitle: 'Create a sign-in key', keyLead: 'A sign-in key proves it is you. It is created in this browser and never leaves it.',
    keyWarn: 'Clearing this site’s data removes the key. There is no password to recover it with.',
    createKey: 'Create sign-in key', keyReady: 'Sign-in key created for this browser.', yourKey: 'Your public key', keyFailed: 'The key could not be created. Check that this browser allows site storage, then try again.',
    repoTitle: 'Start with a repository', create: 'Create a new repository', open: 'Open a repository by address', later: 'Skip for now',
    done: 'You are set up.',
  },
  newRepo: {
    title: 'Create a new repository', lead: 'A repository contains all of your project’s files and their history.',
    name: 'Repository name', nameHint: 'Short and memorable. Letters, numbers, hyphens, dots and underscores.',
    description: 'Description', optional: '(optional)', readme: 'Add a README file', readmeHint: 'A place to describe your project.',
    create: 'Create repository', nameBlank: "Repository name can't be blank", nameInvalid: 'Use only letters, numbers, hyphens, dots and underscores.',
    nameTaken: (name) => `You already have a repository named ${name}.`, needProfile: 'Finish set-up before creating a repository.',
    initial: 'Initial commit',
  },
  openRepo: {
    title: 'Open a repository', lead: 'Enter the address of a repository to copy it into this browser.', address: 'Repository address', placeholder: 'https://example.org/owner/repository.git',
    open: 'Open repository', opening: 'Opening', addressBlank: "Repository address can't be blank", addressInvalid: 'Enter a full address that starts with https:// or http://',
    failed: (reason) => `Could not open this repository. ${reason} Check the address and try again.`,
    unreachable: 'The address did not answer.',
  },
  settings: {
    title: 'Settings', nav: 'Settings', profile: 'Profile', appearance: 'Appearance', security: 'Security',
    profileSaved: 'Profile updated.', saveProfile: 'Update profile',
    themeTitle: 'Theme', themeLead: 'Choose how the interface looks. "Sync with system" follows your device’s light or dark setting.',
    themes: { auto: 'Sync with system', light: 'Light', dark: 'Dark', dark_dimmed: 'Dark dimmed', light_high_contrast: 'Light high contrast', dark_high_contrast: 'Dark high contrast' },
    keyTitle: 'Sign-in key for this browser', keyLead: 'Give this public key to a repository owner who wants to add you as a collaborator.', noKey: 'This browser has no sign-in key yet.',
  },
  notFound: { title: 'Page not found', lead: 'The address may be mistyped, or the page may have moved.', action: 'Go to the homepage' },
  failed: { title: 'Something went wrong', lead: 'Reload the page. If it happens again, check your connection.', action: 'Reload' },
  repo: {
    code: 'Code', pulls: 'Pull requests', commits: 'Commits', notHere: 'This repository is not in this browser.', openByAddress: 'Open by address', navigation: 'Repository',
    local: 'Local',
  },
  parts: {
    breadcrumb: 'Breadcrumb', page: (n) => `Page ${n}`, directory: 'Directory', file: 'File', committed: 'committed', commented: 'commented',
    leaveComment: 'Leave a comment', comment: 'Comment', nothingToPreview: 'Nothing to preview', write: 'Write', preview: 'Preview', contributions: 'Contributions',
    heatmap: (name, total, days) => `${name}: ${total} in the last ${days} days`, justNow: 'just now', ago: (n, unit) => `${n} ${unit}${n === 1 ? '' : 's'} ago`,
  },
  gallery: {
    title: 'Component gallery', lead: 'Every part the screens are built from, for review. Switch themes in Settings to check each one.',
    buttons: 'Buttons', fields: 'Form fields', small: 'Labels, state badges, counters, avatars', tabs: 'Tabs and navigation', menus: 'Menus and dialogs', messages: 'Flash messages and empty states',
    lists: 'Lists and pagination', code: 'File table, commit row, diff', conversation: 'Timeline and comment box', heatmap: 'Contribution heatmap', icons: 'Icons', header: 'Header, signed in',
  },
};
