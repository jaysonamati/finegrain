import {
	App, Editor, MarkdownView, Modal, Plugin, PluginSettingTab, Setting,
	TFile, Notice, setIcon
} from 'obsidian';
import {
	EditorView, Decoration, DecorationSet, ViewPlugin, ViewUpdate, WidgetType
} from '@codemirror/view';
import { RangeSetBuilder } from '@codemirror/state';

// --- CONFIGURATION ---
const DEFAULT_CLAIMS_FILE = "AI_Claims_Master.md";
const DEFAULT_RELEVANCE_FILE = "AI_Relevances.md";
const SEPARATOR = " <br> ";

// --- SETTINGS ---
interface FineGrainSettings {
	claimsFilePath: string;
	relevanceFilePath: string;
}

const DEFAULT_SETTINGS: FineGrainSettings = {
	claimsFilePath: DEFAULT_CLAIMS_FILE,
	relevanceFilePath: DEFAULT_RELEVANCE_FILE
}

// --- MAIN PLUGIN CLASS ---
export default class FineGrainPlugin extends Plugin {
	settings: FineGrainSettings;

	async onload() {
		await this.loadSettings();
		this.registerEditorExtension(fineGrainField(this));
		this.addCommand({
			id: 'link-nuance-to-claim',
			name: 'Link Nuance to Claim',
			editorCallback: (editor: Editor, view: MarkdownView) => {
				new ConnectionModal(this.app, this.settings, (claim, relevance) => {
					this.createLink(editor, claim, relevance);
				}).open();
			}
		});
		this.addSettingTab(new FineGrainSettingTab(this.app, this));
	}

	// --- DATA HANDLING ---

	async createLink(editor: Editor, claim: string, relevance: string) {
		const id = Date.now().toString().slice(-6);
		const safeClaim = this.sanitize(claim);
		const safeRelevance = this.sanitize(relevance);

		const row = `| ${id} | ${safeClaim} | ${safeRelevance} |\n`;

		const relFile = this.getRelevanceFile();
		if (relFile) {
			await this.app.vault.append(relFile, row);
		} else {
			const header = "---\ncssclasses: fg-database\n---\n\n| ID | Claim | Relevance |\n|---|---|---|\n";
			await this.app.vault.create(this.settings.relevanceFilePath, header + row);
		}

		editor.replaceSelection(` (fg:${id}) `);
	}

	async getRelevanceData(id: string): Promise<{ claim: string, relevances: string[] } | null> {
		const relFile = this.getRelevanceFile();
		if (!relFile) return null;

		const content = await this.app.vault.read(relFile);
		const lines = content.split('\n');

		for (let line of lines) {
			if (line.includes(`| ${id} |`)) {
				const parts = line.split('|').map(s => s.trim());
				if (parts.length >= 4) {
					const rawRelevance = parts[3];
					if (!rawRelevance) return { claim: parts[2], relevances: [] };
					const relArray = rawRelevance.split(SEPARATOR).filter(s => s.trim().length > 0);
					return { claim: parts[2], relevances: relArray };
				}
			}
		}
		return null;
	}

	async appendRelevance(id: string, newText: string) {
		const relFile = this.getRelevanceFile();
		if (!relFile) return;

		const content = await this.app.vault.read(relFile);
		const lines = content.split('\n');
		const safeText = this.sanitize(newText);

		const newLines = lines.map(line => {
			if (line.includes(`| ${id} |`)) {
				const parts = line.split('|');
				if (parts.length >= 4) {
					const current = parts[3].trim();
					const separator = current.length > 0 ? SEPARATOR : " ";
					parts[3] = ` ${current}${separator}${safeText} `;
					return parts.join('|');
				}
			}
			return line;
		});

		await this.app.vault.modify(relFile, newLines.join('\n'));
	}

	async removeRelevanceItem(id: string, indexToRemove: number) {
		const relFile = this.getRelevanceFile();
		if (!relFile) return;

		const content = await this.app.vault.read(relFile);
		const lines = content.split('\n');

		const newLines = lines.map(line => {
			if (line.includes(`| ${id} |`)) {
				const parts = line.split('|');
				if (parts.length >= 4) {
					let relArray = parts[3].split(SEPARATOR).filter(s => s.trim().length > 0);
					if (indexToRemove >= 0 && indexToRemove < relArray.length) {
						relArray.splice(indexToRemove, 1);
					}
					parts[3] = " " + relArray.join(SEPARATOR) + " ";
					return parts.join('|');
				}
			}
			return line;
		});

		await this.app.vault.modify(relFile, newLines.join('\n'));
	}

	async deleteConnection(id: string) {
		// 1. Remove from Database
		const relFile = this.getRelevanceFile();
		if (relFile) {
			const content = await this.app.vault.read(relFile);
			const lines = content.split('\n');
			const newLines = lines.filter(line => !line.includes(`| ${id} |`));
			await this.app.vault.modify(relFile, newLines.join('\n'));
		}

		// 2. Remove tag from Editor & Restore Cursor
		const view = this.app.workspace.getActiveViewOfType(MarkdownView);
		if (view) {
			const editor = view.editor;
			const currentCursor = editor.getCursor();
			const lineCount = editor.lineCount();

			for (let i = 0; i < lineCount; i++) {
				const lineText = editor.getLine(i);
				if (lineText.includes(`(fg:${id})`)) {
					// Regex to remove the tag and leading whitespace
					const regex = new RegExp(`[ \\t]*\\(fg:${id}\\)`, 'g');
					const newLineText = lineText.replace(regex, "");
					editor.setLine(i, newLineText);

					// Logic to ensure cursor stays put
					if (currentCursor.line === i) {
						editor.setCursor({
							line: i,
							ch: Math.min(currentCursor.ch, newLineText.length)
						});
					} else {
						editor.setCursor(currentCursor);
					}
					break;
				}
			}
		}
	}

	sanitize(text: string) {
		return text.replace(/\|/g, "-").replace(/\n/g, " ").trim();
	}

	getRelevanceFile() {
		return this.app.vault.getAbstractFileByPath(this.settings.relevanceFilePath) as TFile;
	}

	async loadSettings() {
		this.settings = Object.assign({}, DEFAULT_SETTINGS, await this.loadData());
	}

	async saveSettings() {
		await this.saveData(this.settings);
	}
}

// --- EDITOR EXTENSION (ICON BUTTON) ---
class AIButtonWidget extends WidgetType {
	id: string;
	plugin: FineGrainPlugin;
	constructor(id: string, plugin: FineGrainPlugin) { super(); this.id = id; this.plugin = plugin; }
	toDOM(view: EditorView): HTMLElement {
		const span = document.createElement("span");
		span.className = "fg-ai-button";
		setIcon(span, "network");
		span.onclick = async (e) => {
			e.preventDefault();
			const data = await this.plugin.getRelevanceData(this.id);
			if (data) {
				new DisplayModal(this.plugin.app, this.plugin, this.id, data.claim, data.relevances).open();
			} else {
				new Notice("Connection not found (ID: " + this.id + ")");
			}
		};
		return span;
	}
}

function fineGrainField(plugin: FineGrainPlugin) {
	return ViewPlugin.fromClass(
		class {
			decorations: DecorationSet;
			constructor(view: EditorView) { this.decorations = this.buildDecorations(view); }
			update(update: ViewUpdate) { if (update.docChanged || update.viewportChanged) this.decorations = this.buildDecorations(update.view); }
			buildDecorations(view: EditorView) {
				const builder = new RangeSetBuilder<Decoration>();
				const regex = /\(fg:(\d+)\)/g;
				for (let { from, to } of view.visibleRanges) {
					const text = view.state.doc.sliceString(from, to);
					let match;
					while ((match = regex.exec(text))) {
						builder.add(from + match.index, from + match.index + match[0].length, Decoration.widget({ widget: new AIButtonWidget(match[1], plugin), side: 1 }));
					}
				}
				return builder.finish();
			}
		}, { decorations: (v) => v.decorations }
	);
}

// --- MODAL 1: INPUT ---
class ConnectionModal extends Modal {
	settings: FineGrainSettings;
	onSubmit: (claim: string, relevance: string) => void;
	constructor(app: App, settings: FineGrainSettings, onSubmit: (c: string, r: string) => void) {
		super(app); this.settings = settings; this.onSubmit = onSubmit;
	}
	async onOpen() {
		const { contentEl } = this;
		contentEl.createEl("h2", { text: "Link Nuance (Investigable) to Claim" });
		const file = this.app.vault.getAbstractFileByPath(this.settings.claimsFilePath);
		let claims: string[] = [];
		if (file instanceof TFile) {
			const text = await this.app.vault.read(file);
			claims = text.split("\n").filter(l => l.trim().startsWith("-")).map(l => l.replace(/^- /, "").trim());
		}
		const dropdown = contentEl.createEl("select", { cls: "dropdown", attr: { style: "width: 100%; margin-bottom: 15px;" } });
		claims.forEach(c => { const opt = dropdown.createEl("option"); opt.value = c; opt.text = c; });
		const textArea = contentEl.createEl("textarea", { attr: { rows: "4", style: "width:100%", placeholder: "Why is this relevant to AI Integration?" } });
		contentEl.createEl("br"); contentEl.createEl("br");
		const btn = contentEl.createEl("button", { text: "Create Link", cls: "mod-cta" });
		btn.onclick = () => { this.onSubmit(dropdown.value, textArea.value); this.close(); };
	}
	onClose() { this.contentEl.empty(); }
}

// --- MODAL 2: DISPLAY ---
class DisplayModal extends Modal {
	plugin: FineGrainPlugin;
	id: string;
	claim: string;
	relevances: string[];

	constructor(app: App, plugin: FineGrainPlugin, id: string, claim: string, relevances: string[]) {
		super(app);
		this.plugin = plugin;
		this.id = id;
		this.claim = claim;
		this.relevances = relevances;
	}

	onOpen() { this.render(); }

	render() {
		const { contentEl } = this;
		contentEl.empty();

		//contentEl.createEl("h6", { text: "CONNECTION ID: " + this.id, cls: "fg-id-header" });
		const title = contentEl.createEl("h2", { text: this.claim });
		title.style.marginTop = "0px"; title.style.color = "var(--text-accent)";
		contentEl.createEl("hr");

		contentEl.createEl("h4", { text: "Relevances to (Predictions of) AI integration" });
		const list = contentEl.createEl("ul", { cls: "fg-relevance-list" });

		if (this.relevances.length === 0) {
			list.createEl("li", { text: "No notes yet.", style: "font-style: italic; color: var(--text-muted);" });
		}

		this.relevances.forEach((rel, index) => {
			const item = list.createEl("li", { cls: "fg-list-item" });
			const textSpan = item.createEl("span", { text: rel });
			const delBtn = item.createEl("span", { cls: "fg-delete-item-btn", title: "Delete this note" });
			setIcon(delBtn, "x");
			delBtn.onclick = async () => {
				await this.plugin.removeRelevanceItem(this.id, index);
				this.relevances.splice(index, 1);
				this.render();
			};
		});

		contentEl.createEl("br");

		const addSection = contentEl.createDiv({ cls: "fg-add-section" });
		addSection.createEl("small", { text: "Add another relevance:" });
		const input = addSection.createEl("textarea", { attr: { rows: "2", style: "width: 100%; margin-top: 5px;" }, placeholder: "Additional context..." });

		const footerDiv = addSection.createDiv({ cls: "fg-modal-footer" });

		const addBtn = footerDiv.createEl("button", { text: "Add Note", cls: "mod-cta" });
		addBtn.onclick = async () => {
			if (input.value.trim().length > 0) {
				await this.plugin.appendRelevance(this.id, input.value);
				this.relevances.push(input.value.replace(/\|/g, "-").replace(/\n/g, " ").trim());
				this.render();
				new Notice("Note added!");
			}
		};

		const dangerBtn = footerDiv.createEl("button", { text: "Delete Connection", cls: "mod-warning" });
		dangerBtn.style.float = "left";
		dangerBtn.onclick = async () => {
			if (confirm("Are you sure you want to delete this connection?")) {
				await this.plugin.deleteConnection(this.id);
				new Notice("Connection deleted.");
				this.close(); // Close the modal

				// FIX: Force focus back to the editor after the modal logic clears
				setTimeout(() => {
					const view = this.plugin.app.workspace.getActiveViewOfType(MarkdownView);
					if (view) {
						view.editor.focus();
					}
				}, 50);
			}
		};
	}
	onClose() { this.contentEl.empty(); }
}

class FineGrainSettingTab extends PluginSettingTab {
	plugin: FineGrainPlugin;
	constructor(app: App, plugin: FineGrainPlugin) { super(app, plugin); this.plugin = plugin; }
	display(): void {
		const { containerEl } = this; containerEl.empty();
		new Setting(containerEl).setName('Claims File').addText(t => t.setValue(this.plugin.settings.claimsFilePath).onChange(async v => { this.plugin.settings.claimsFilePath = v; await this.plugin.saveSettings(); }));
		new Setting(containerEl).setName('Relevance File').addText(t => t.setValue(this.plugin.settings.relevanceFilePath).onChange(async v => { this.plugin.settings.relevanceFilePath = v; await this.plugin.saveSettings(); }));
	}
}
