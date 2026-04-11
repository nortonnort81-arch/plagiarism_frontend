// PlagiCheck - JavaScript for interactions

document.addEventListener('DOMContentLoaded', function() {
  const modals = document.querySelectorAll('.modal');
  const modalTriggers = document.querySelectorAll('[data-modal]');
  const modalCloseBtns = document.querySelectorAll('[data-modal-close]');

  modalTriggers.forEach(trigger => {
    trigger.addEventListener('click', function(e) {
      e.preventDefault();
      const modalId = this.getAttribute('data-modal');
      const modal = document.getElementById(modalId);
      if (modal) {
        modal.classList.add('active');
      }
    });
  });

  modalCloseBtns.forEach(btn => {
    btn.addEventListener('click', function() {
      const modal = this.closest('.modal');
      if (modal) {
        modal.classList.remove('active');
      }
    });
  });

  modals.forEach(modal => {
    modal.addEventListener('click', function(e) {
      if (e.target === this) {
        this.classList.remove('active');
      }
    });
  });

  const textarea = document.getElementById('scan-text');
  const wordCountEl = document.getElementById('word-count');

  if (textarea && wordCountEl) {
    textarea.addEventListener('input', function() {
      const words = this.value.trim().split(/\s+/).filter(word => word.length > 0).length;
      wordCountEl.textContent = `${words}/25000 words`;
    });
  }

  const plagiarizedTexts = document.querySelectorAll('.plagiarized-text');

  plagiarizedTexts.forEach((textElement, index) => {
    textElement.addEventListener('click', function() {
      const sources = document.querySelectorAll('.source-item');
      if (sources[index]) {
        sources[index].scrollIntoView({ behavior: 'smooth', block: 'center' });
        sources[index].style.borderLeftColor = '#fbbf24';
        sources[index].style.backgroundColor = 'rgba(251, 191, 36, 0.1)';

        setTimeout(() => {
          sources[index].style.borderLeftColor = '';
          sources[index].style.backgroundColor = '';
        }, 2000);
      }
    });

    textElement.style.cursor = 'pointer';
  });

  const sourceLinks = document.querySelectorAll('.source-url');
  sourceLinks.forEach(link => {
    link.addEventListener('click', function(e) {
      if (!this.href || this.href === '#') {
        e.preventDefault();
      }
    });
  });
});
