from pathlib import Path
import re

p = Path('index.html')
s = p.read_text(encoding='utf-8')

# Remove every controller from the earlier attempts, including copies that
# were accidentally duplicated and copies containing a literal backslash-n.
s = re.sub(
    r'(?:\\n|\n)\s*/\* Definitive validation retry controller(?: - final)? \*/.*?\n\}\)\(\);',
    '\n',
    s,
    flags=re.S,
)

# Remove our current isolated controller before rebuilding exactly one copy.
s = re.sub(
    r'(?:\\n|\n)\s*/\* Price Portal validation retry controller \*/.*?\n\}\)\(\);',
    '\n',
    s,
    flags=re.S,
)

patch = r'''/* Price Portal validation retry controller */
(function(){
  function errorsFor(w){
    const errors=[];
    const name=w.querySelector('.customer-name');
    const loc=w.querySelector('.location');
    const pharm=w.querySelector('.pharm');
    const qtys=[...w.querySelectorAll('.qty')];
    const ns=w.querySelector('.nostock');
    const photo=w.querySelector('.photo');

    if(!(name?.value||'').trim()) errors.push('Pharmacy / Customer name is required');
    if(!(loc?.value||'').trim()) errors.push('Area is required');

    const pharmacist=(pharm?.value||'').trim();
    if(!pharmacist) errors.push('Pharmacist is required');
    else if(!/^[A-Za-z][A-Za-z .\'-]{1,99}$/.test(pharmacist)) errors.push('Pharmacist name is invalid');

    let positive=0;
    let invalidQty=false;
    qtys.forEach(q=>{
      const raw=(q.value||'').trim();
      if(raw!=='' && !/^\d+$/.test(raw)) invalidQty=true;
      const n=raw==='' ? 0 : Number(raw);
      if(Number.isFinite(n) && n>0) positive+=n;
    });
    if(invalidQty) errors.push('Quantity must be a whole number of 0 or more');

    const noStock=!!ns?.checked;
    if(positive<=0 && !noStock) errors.push('Enter at least one positive quantity or select No Stock');
    if(noStock && positive>0) errors.push('No Stock cannot be selected when a positive quantity is entered');

    if(!w.dataset.attachment && !(photo?.files?.length)) errors.push('Photo is required');
    return errors;
  }

  function refresh(w){
    if(!w || w.dataset.validationAttempted!=='1' || w.dataset.saving==='1') return;
    const msg=w.querySelector('.msg');
    if(!msg) return;
    const errors=errorsFor(w);
    msg.textContent=errors.length
      ? 'Please complete the following before saving:\n'+errors.map(x=>'• '+x).join('\n')
      : '';
    msg.className=errors.length ? 'msg small err' : 'msg small';
    const save=w.querySelector('.save');
    if(save){
      save.disabled=false;
      save.removeAttribute('disabled');
      save.removeAttribute('aria-busy');
    }
  }

  // Capture before the original save handler runs. This does not replace it.
  document.addEventListener('click',function(e){
    const save=e.target.closest('.customer .save');
    if(save){
      const w=save.closest('.customer');
      if(w) w.dataset.validationAttempted='1';
      setTimeout(function(){ if(w) refresh(w); },0);
    }
  },true);

  function changed(e){
    const w=e.target.closest('.customer');
    if(w && w.dataset.validationAttempted==='1') setTimeout(function(){refresh(w)},0);
  }
  document.addEventListener('input',changed,true);
  document.addEventListener('change',changed,true);

  window.__refreshPriceChangeValidation=refresh;
})();
'''

if '</script>' not in s:
    raise SystemExit('index.html has no closing script tag')
s = s.replace('</script>', patch + '\n</script>', 1)
p.write_text(s, encoding='utf-8')
print('LEGACY controllers removed; one safe controller installed')
