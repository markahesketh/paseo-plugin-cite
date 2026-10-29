// jsdom has no DataTransfer or DragEvent, so file drops get minimal stand-ins.
export function installDragAndDrop(window) {
  window.DataTransfer = class {
    files = [];
    types = [];
    items = {
      add: (file) => {
        this.files.push(file);
        this.types = ["Files"];
      },
    };
  };
  window.DragEvent = class extends window.Event {
    constructor(type, init) {
      super(type, init);
      this.dataTransfer = init.dataTransfer;
    }
  };
}
